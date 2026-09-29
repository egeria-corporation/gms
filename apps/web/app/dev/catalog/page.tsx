// SPDX-License-Identifier: AGPL-3.0-or-later
// Screen catalog: every spec screen grouped by surface, with links to the route and each `?state=` variant.
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Section,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gms/ui';
import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CATALOG, catalogBySurface, catalogUrl, isDynamicPath, type CatalogScreen } from '@/lib/catalog';
import { config } from '@/lib/config';
import { one } from '@/lib/site';

export const metadata: Metadata = { title: 'Screen catalog' };

function ScreenLink({
  screen,
  href,
  children,
}: {
  screen: CatalogScreen;
  href: string;
  children: ReactNode;
}) {
  const cls = 'rounded-sm text-link underline-offset-4 hover:underline';
  if (screen.tenantScoped) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  const rootOrigin = `${config.protocol}://${config.rootDomain}`;
  return (
    <a href={`${rootOrigin}${href}`} className={`${cls} inline-flex items-center gap-1`}>
      {children}
      <ExternalLink className="size-3" aria-hidden="true" />
      <span className="sr-only">(opens on the root host)</span>
    </a>
  );
}

function matches(s: CatalogScreen, q: string): boolean {
  const needle = q.toLowerCase();
  return [s.id, s.title, s.path, ...s.states].some((v) => v.toLowerCase().includes(needle));
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = (one((await searchParams).q) ?? '').trim();
  const screens = q ? CATALOG.filter((s) => matches(s, q)) : CATALOG;
  const groups = catalogBySurface(screens);
  const stateCount = CATALOG.reduce((n, s) => n + s.states.length, 0);
  const rootOrigin = `${config.protocol}://${config.rootDomain}`;

  return (
    <>
      <PageHeader
        title="Screen catalog"
        description={`${CATALOG.length} screens and ${stateCount} forced states. Add ?state= to any tenant route outside production to see a documented state.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dev/design-system">Design system</Link>
          </Button>
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter screens">
        <Field label="Filter by id, title, path or state" htmlFor="catalog-q" className="w-full max-w-sm">
          <Input id="catalog-q" name="q" defaultValue={q} placeholder="e.g. S-0, payments, empty" />
        </Field>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {q ? (
          <Button asChild variant="ghost">
            <Link href="/dev/catalog">Clear</Link>
          </Button>
        ) : null}
      </form>

      <p className="text-sm text-muted-foreground">
        Tenant screens link relative to this workspace host. Platform screens open on the root host,{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{rootOrigin}</code>.
      </p>

      <nav aria-label="Surfaces" className="flex flex-wrap gap-2 text-sm">
        {groups.map((g) => (
          <a
            key={g.surface}
            href={`#surface-${g.surface}`}
            className="rounded-md border px-2 py-1 hover:bg-muted"
          >
            {g.label} <span className="text-muted-foreground tabular-nums">({g.screens.length})</span>
          </a>
        ))}
      </nav>

      {groups.length === 0 ? (
        <EmptyState
          title="No screens match that filter"
          description="Try a screen id like B-09, a path segment like payments, or a state like empty."
          action={
            <Button asChild variant="outline">
              <Link href="/dev/catalog">Show every screen</Link>
            </Button>
          }
        />
      ) : null}

      {groups.map((g) => (
        <Section
          key={g.surface}
          id={`surface-${g.surface}`}
          title={g.label}
          description={g.screens[0]?.tenantScoped ? 'Workspace host' : 'Root host'}
        >
          <Table containerLabel={`${g.label} screens`} containerClassName="rounded-lg border bg-card">
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="w-32">
                  Id
                </TableHead>
                <TableHead scope="col">Screen</TableHead>
                <TableHead scope="col">Route</TableHead>
                <TableHead scope="col">States</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.screens.map((s) => {
                const base = catalogUrl(s);
                const dynamic = isDynamicPath(s.path);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="align-top font-mono text-xs whitespace-nowrap">{s.id}</TableCell>
                    <TableCell className="align-top">
                      <span className="font-medium">{s.title}</span>
                      {s.notes ? (
                        <p className="mt-0.5 max-w-md text-xs text-muted-foreground">{s.notes}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="grid gap-1">
                        {dynamic ? (
                          <code className="text-xs">{s.path}</code>
                        ) : (
                          <ScreenLink screen={s} href={s.path}>
                            <code className="text-xs">{s.path}</code>
                          </ScreenLink>
                        )}
                        {dynamic && base ? (
                          <span className="text-xs">
                            Example:{' '}
                            <ScreenLink screen={s} href={base}>
                              <code>{base}</code>
                            </ScreenLink>
                          </span>
                        ) : null}
                        {!dynamic && s.example ? (
                          <span className="text-xs">
                            Also:{' '}
                            <ScreenLink screen={s} href={s.example}>
                              <code>{s.example}</code>
                            </ScreenLink>
                          </span>
                        ) : null}
                        {!s.tenantScoped ? <Badge variant="outline">Root host</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      {s.states.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Default only</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {s.states.map((st) => {
                            const href = catalogUrl(s, st);
                            return (
                              <li key={st}>
                                {href ? (
                                  <ScreenLink screen={s} href={href}>
                                    <span className="font-mono text-xs">{st}</span>
                                  </ScreenLink>
                                ) : (
                                  <span className="font-mono text-xs text-muted-foreground">{st}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      ))}
    </>
  );
}
