// SPDX-License-Identifier: AGPL-3.0-only
// DS-05 Shells. Live shells render landmarks, a skip link and an <h1>, which can't nest inside this page,
// so each shell gets a schematic thumbnail and a link to a real route that uses it.
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Section,
} from '@gms/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

type Layout = 'public' | 'portal' | 'console' | 'focused-aside' | 'focused';

const SHELLS: {
  name: string;
  component: string;
  route: string;
  audience: string;
  description: string;
  layout: Layout;
  branding: string;
}[] = [
  {
    name: 'Public',
    component: 'PublicShell',
    route: '/',
    audience: 'Anyone',
    description: 'Foundation site: logo header, opportunities nav, brand pattern hero, powered-by footer.',
    layout: 'public',
    branding: 'Full brand',
  },
  {
    name: 'Portal',
    component: 'PortalShell',
    route: '/portal',
    audience: 'Applicants & grantees',
    description:
      'Top bar with organization switcher and account menu; a single centered column sized for forms.',
    layout: 'portal',
    branding: 'Full brand',
  },
  {
    name: 'Console',
    component: 'ConsoleShell',
    route: '/console',
    audience: 'Foundation staff',
    description:
      'Collapsible sidebar grouped by module, command palette, approval inbox, dense content area.',
    layout: 'console',
    branding: 'Console subset',
  },
  {
    name: 'Reviewer',
    component: 'ReviewerShell',
    route: '/review',
    audience: 'Reviewers',
    description: 'Focused layout: the application on the left, the scorecard in a sticky aside.',
    layout: 'focused-aside',
    branding: 'Full brand',
  },
  {
    name: 'Board',
    component: 'BoardShell',
    route: '/board',
    audience: 'Board members',
    description: 'Focused, large-type docket reading with an aside for notes and votes.',
    layout: 'focused',
    branding: 'Full brand',
  },
];

function Bar({ className = '' }: { className?: string }) {
  return <span className={`block rounded-sm bg-muted-foreground/25 ${className}`} />;
}

function Thumb({ layout }: { layout: Layout }) {
  let inner: ReactNode;
  if (layout === 'console') {
    inner = (
      <div className="grid h-full grid-cols-[28%_1fr]">
        <div className="grid content-start gap-1.5 border-r bg-sidebar p-2">
          <Bar className="h-2 w-3/4 bg-console-accent/60" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Bar key={i} className={`h-1.5 ${i === 2 ? 'w-full bg-console-accent/50' : 'w-2/3'}`} />
          ))}
        </div>
        <div className="grid content-start gap-1.5 p-2">
          <Bar className="h-2.5 w-1/2" />
          <div className="grid grid-cols-3 gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-5 rounded-sm border bg-card" />
            ))}
          </div>
          {[0, 1, 2, 3].map((i) => (
            <Bar key={i} className="h-1.5 w-full" />
          ))}
        </div>
      </div>
    );
  } else if (layout === 'public') {
    inner = (
      <div className="grid h-full grid-rows-[auto_1fr_auto]">
        <div className="flex items-center justify-between border-b p-2">
          <Bar className="h-2 w-1/4 bg-primary/60" />
          <Bar className="h-1.5 w-1/3" />
        </div>
        <div className="grid content-start gap-1.5 p-2">
          <span className="h-8 rounded-sm bg-brand-200" />
          <Bar className="h-2 w-2/3" />
          <Bar className="h-1.5 w-1/2" />
        </div>
        <div className="border-t p-1.5">
          <Bar className="h-1 w-1/3" />
        </div>
      </div>
    );
  } else if (layout === 'portal') {
    inner = (
      <div className="grid h-full grid-rows-[auto_1fr]">
        <div className="flex items-center justify-between border-b p-2">
          <Bar className="h-2 w-1/5 bg-primary/60" />
          <span className="size-2.5 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="mx-auto grid w-3/5 content-start gap-1.5 p-2">
          <Bar className="h-2.5 w-2/3" />
          <span className="h-4 rounded-sm border bg-card" />
          <span className="h-4 rounded-sm border bg-card" />
          <Bar className="h-3 w-1/3 bg-primary/60" />
        </div>
      </div>
    );
  } else {
    inner = (
      <div className="grid h-full grid-rows-[auto_1fr]">
        <div className="flex items-center justify-between border-b p-2">
          <Bar className="h-2 w-1/4" />
          <Bar className="h-1.5 w-1/6" />
        </div>
        <div
          className={`grid gap-2 p-2 ${layout === 'focused-aside' ? 'grid-cols-[1fr_38%]' : 'grid-cols-[1fr_28%]'}`}
        >
          <div className="grid content-start gap-1.5">
            <Bar className={layout === 'focused' ? 'h-3 w-2/3' : 'h-2.5 w-2/3'} />
            {[0, 1, 2, 3].map((i) => (
              <Bar key={i} className="h-1.5 w-full" />
            ))}
          </div>
          <div className="grid content-start gap-1.5 rounded-sm border bg-card p-1.5">
            <Bar className="h-1.5 w-2/3" />
            <Bar className="h-3 w-full bg-primary/40" />
            <Bar className="h-1.5 w-1/2" />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="aspect-[16/10] overflow-hidden rounded-md border bg-background">
      {inner}
    </div>
  );
}

export function ShellsSection() {
  return (
    <Section
      id="ds-05"
      title="DS-05 Shells"
      description="Five page frames. Each owns the skip link, landmarks, navigation and the powered-by footer; pages render inside them."
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SHELLS.map((s) => (
          <li key={s.component}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle as="h3" className="flex flex-wrap items-center gap-2">
                  {s.name}
                  <Badge variant="outline">{s.branding}</Badge>
                </CardTitle>
                <CardDescription>
                  <code className="text-xs">{s.component}</code> · {s.audience}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Thumb layout={s.layout} />
                <p className="text-sm text-muted-foreground">{s.description}</p>
              </CardContent>
              <CardFooter className="mt-auto">
                <Button asChild variant="outline" size="sm">
                  <Link href={s.route}>
                    Open {s.route}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}
