// SPDX-License-Identifier: AGPL-3.0-or-later
// Platform directory (root host): foundations on this GMS with open opportunities (states: empty, not-set-up).
// Public information only: brand display name and the count of open, public opportunities.
import { getRuntime, originFor } from '@gms/actions';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@gms/ui';
import { ArrowRight, Building2, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { forcedState } from '@/lib/site';

export const metadata: Metadata = { title: 'Foundations on GMS' };

interface DirectoryEntry {
  slug: string;
  name: string;
  open: number;
}

async function loadDirectory(): Promise<{ entries: DirectoryEntry[]; anyWorkspace: boolean }> {
  const db = getRuntime().db;
  const [rows, any] = await Promise.all([
    db
      .selectFrom('workspaces as w')
      .innerJoin('workspace_brand as b', 'b.workspace_id', 'w.id')
      .innerJoin('opportunities as o', 'o.workspace_id', 'w.id')
      .select(['w.slug', 'b.display_name', (eb) => eb.fn.countAll<number>().as('open')])
      .where('w.status', '=', 'active')
      .where('o.status', '=', 'open')
      .where('o.visibility', '=', 'public')
      .groupBy(['w.slug', 'b.display_name'])
      .orderBy('b.display_name')
      .limit(200)
      .execute(),
    db.selectFrom('workspaces').select('id').limit(1).executeTakeFirst(),
  ]);
  return { entries: rows.map((r) => ({ slug: r.slug, name: r.display_name, open: Number(r.open) })), anyWorkspace: Boolean(any) };
}

export default async function PlatformDirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const state = forcedState(await searchParams);
  const loaded = state === 'empty' || state === 'not-set-up' ? { entries: [], anyWorkspace: state !== 'not-set-up' } : await loadDirectory();
  const { entries, anyWorkspace } = loaded;
  return (
    <div className="grid gap-10 py-10">
      <section aria-labelledby="directory-title" className="grid gap-4">
        <h1 id="directory-title" className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          Foundations accepting applications
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Each foundation below runs its own grants site on GMS. Open one to see its opportunities, check eligibility and apply.
        </p>
        <div className="flex flex-wrap gap-3">
          {anyWorkspace ? null : (
            <Button asChild size="lg">
              <Link href="/setup">
                <Sparkles aria-hidden="true" /> Set up GMS
              </Link>
            </Button>
          )}
          <Button asChild size="lg" variant={anyWorkspace ? 'secondary' : 'ghost'}>
            <Link href="/sign-in">Operator sign in</Link>
          </Button>
        </div>
      </section>

      {!anyWorkspace ? (
        <EmptyState
          icon={Sparkles}
          title="This GMS isn’t set up yet"
          description="Create your foundation’s workspace in about five minutes: name, colors, email and your first program."
          action={
            <Button asChild>
              <Link href="/setup">Start setup</Link>
            </Button>
          }
        />
      ) : entries.length === 0 ? (
        <EmptyState icon={Building2} title="No open opportunities right now" description="Foundations post new funding rounds on their own sites. Check back soon." />
      ) : (
        <section aria-labelledby="foundations-title" className="grid gap-4">
          <h2 id="foundations-title" className="font-heading text-xl font-semibold">
            {entries.length} {entries.length === 1 ? 'foundation' : 'foundations'} with open opportunities
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((e) => {
              const origin = originFor(e.slug);
              return (
                <li key={e.slug}>
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle as="h3">{e.name}</CardTitle>
                      <CardDescription>
                        {e.open} open {e.open === 1 ? 'opportunity' : 'opportunities'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <a className="inline-flex items-center gap-1 text-sm font-medium text-link underline underline-offset-2" href={`${origin}/opportunities`}>
                        See opportunities<span className="sr-only"> from {e.name}</span> <ArrowRight className="size-4" aria-hidden="true" />
                      </a>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{origin.replace(/^https?:\/\//, '')}</div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
